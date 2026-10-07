"""管理员后台端点：用户管理、题库增删改查、模型与检索配置。

全部挂在 get_current_admin 之下（非管理员 403）。题目是跨用户复用的公共资源，
改题要同步向量库，否则检索会命中已删的旧题。
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import llm
from app.api.deps import get_current_admin, get_db
from app.core.security import hash_password
from app.models.user import User
from app.rag import vectorstore
from app.repositories import config as config_repo
from app.repositories import question as question_repo
from app.repositories import user as user_repo
from app.schemas.admin import AdminQuestionIn, ConfigUpdate
from app.services import settings_service

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------- 用户管理 ----------


@router.get("/users")
async def list_users(
    keyword: str = Query(""),
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """用户列表，可按邮箱/昵称模糊搜索。"""
    users = await user_repo.list_all(db, keyword)
    return [
        {
            "id": u.id,
            "email": u.email,
            "nickname": u.nickname,
            "is_admin": u.is_admin,
            "created_at": u.created_at,
        }
        for u in users
    ]


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    payload: dict,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """修改用户：昵称 / 管理员标记 / 重置密码。"""
    if user_id == admin.id and payload.get("is_admin") is False:
        raise HTTPException(status_code=400, detail="不能取消自己的管理员权限")
    hashed = hash_password(payload["password"]) if payload.get("password") else None
    user = await user_repo.update(
        db,
        user_id,
        nickname=payload.get("nickname"),
        is_admin=payload.get("is_admin"),
        hashed_password=hashed,
    )
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"id": user.id, "email": user.email, "nickname": user.nickname, "is_admin": user.is_admin}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """删除用户。"""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    ok = await user_repo.delete(db, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"status": "ok"}


# ---------- 题库管理 ----------


@router.get("/questions")
async def list_questions(
    keyword: str = Query(""),
    direction: str = Query(""),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """题库分页查询。"""
    offset = (page - 1) * size
    rows, total = await question_repo.list_paged(db, keyword, direction, offset, size)
    return {
        "total": total,
        "page": page,
        "size": size,
        "items": [
            {
                "id": q.id,
                "direction": q.direction,
                "difficulty": q.difficulty,
                "question_type": q.question_type,
                "content": q.content,
                "reference_answer": q.reference_answer,
                "key_points": q.key_points,
                "embedding_ref": q.embedding_ref,
                "created_at": q.created_at,
            }
            for q in rows
        ],
    }


@router.post("/questions")
async def create_question(
    payload: AdminQuestionIn,
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """新建题目：PG 落库后向量化入 Qdrant。"""
    question = await question_repo.create(
        db,
        payload.direction,
        payload.difficulty,
        payload.question_type,
        payload.content,
        payload.reference_answer,
        payload.key_points,
    )
    chunk_id = await asyncio.to_thread(
        vectorstore.upsert_question,
        question.id,
        payload.direction,
        payload.difficulty,
        payload.question_type,
        payload.content,
        payload.reference_answer,
        payload.key_points,
    )
    await question_repo.set_embedding_ref(db, question.id, chunk_id)
    return {"id": question.id, "embedding_ref": chunk_id}


@router.put("/questions/{question_id}")
async def update_question(
    question_id: int,
    payload: AdminQuestionIn,
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """编辑题目：改 PG 后重新向量化写回 Qdrant（同一 point id 覆盖）。"""
    question = await question_repo.update(
        db,
        question_id,
        payload.direction,
        payload.difficulty,
        payload.question_type,
        payload.content,
        payload.reference_answer,
        payload.key_points,
    )
    if question is None:
        raise HTTPException(status_code=404, detail="题目不存在")
    chunk_id = await asyncio.to_thread(
        vectorstore.upsert_question,
        question.id,
        payload.direction,
        payload.difficulty,
        payload.question_type,
        payload.content,
        payload.reference_answer,
        payload.key_points,
    )
    await question_repo.set_embedding_ref(db, question.id, chunk_id)
    return {"id": question.id, "embedding_ref": chunk_id}


@router.delete("/questions/{question_id}")
async def delete_question(
    question_id: int,
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """删除题目：PG 与 Qdrant 同步删。"""
    ok = await question_repo.delete(db, question_id)
    if not ok:
        raise HTTPException(status_code=404, detail="题目不存在")
    await asyncio.to_thread(vectorstore.delete_question, question_id)
    return {"status": "ok"}


# ---------- 统计 ----------


@router.get("/stats")
async def stats(
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """后台首页概览。

    把概览卡片要的数字一次给全（用户数/题量/管理员数/近 7 天新增/方向分布），
    否则前端为了画一个分布图得把整个题库拉下来自己数。
    """
    from datetime import datetime, timedelta

    return {
        "users": await user_repo.count(db),
        "questions": await question_repo.count(db),
        "admins": await user_repo.count_admins(db),
        "new_users_7d": await user_repo.count_created_since(
            db, datetime.now() - timedelta(days=7)
        ),
        "directions": await question_repo.count_by_direction(db),
    }


# ---------- 模型与检索配置 ----------


@router.get("/llm/options")
async def llm_options(
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """给模型下拉框用的实时候选：服务商预置 + 从当前端点拉到的模型 id。

    端点拉不通（网络、key 无效、网关没有 /models）不是错误，回退到静态候选列表并把
    原因带回去，后台照常能改配置 —— 换个端点恰恰是修好它的手段，不能因此把页面锁死。
    """
    base_url = await settings_service.effective(db, "llm_base_url")
    api_key = await settings_service.effective(db, "llm_api_key")
    fallback = list(settings_service.model_options())
    try:
        models = await llm.list_models(base_url, api_key)
    except Exception as exc:  # noqa: BLE001 —— 拉取失败只降级，不阻断
        return {
            "presets": list(settings_service.all_presets()),
            "models": fallback,
            "source": "fallback",
            "error": f"{type(exc).__name__}: {exc}",
        }
    if not models:
        return {
            "presets": list(settings_service.all_presets()),
            "models": fallback,
            "source": "fallback",
            "error": "端点没有返回模型列表",
        }
    return {
        "presets": list(settings_service.all_presets()),
        "models": models,
        "source": "live",
        "error": "",
    }


@router.get("/config")
async def get_config(
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """配置快照：每项带默认值、当前生效值、说明、是否被覆盖。"""
    return await settings_service.snapshot(db)


@router.put("/config")
async def update_config(
    payload: ConfigUpdate,
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """批量更新配置，改完立即生效（缓存失效，graph 下次执行就读到新值）。

    密文项（API Key）传空值表示「不修改」：页面不回显已存的密钥，所以空值只可能是
    「没填」，不可能是「想清空」。真要清空就点「恢复默认」删掉这条覆盖记录。
    """
    specs = {spec.key: spec for spec in settings_service.all_specs()}
    for key, value in payload.values.items():
        spec = specs.get(key)
        if spec is None:
            raise HTTPException(status_code=400, detail=f"未知配置项：{key}")
        if spec.kind == "secret" and not value:
            continue
        await config_repo.set(db, key, value)
    return await settings_service.snapshot(db)


@router.get("/llm/options")
async def llm_options(
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """「模型接入」配置页要的两个东西：服务商预置 + 端点的实时模型列表。

    拉实时列表失败不算错误（端点不支持 /models、网络不通、密钥无效都可能），
    降级成静态候选并把原因带回去，页面照常可用。
    """
    from app.agent.llm import list_models

    base_url = await settings_service.effective(db, "llm_base_url")
    api_key = await settings_service.effective(db, "llm_api_key")

    models: list[str] = []
    error = ""
    try:
        models = await list_models(base_url, api_key)
    except Exception as exc:  # noqa: BLE001 —— 拉取失败降级即可，不该让配置页打不开
        error = f"{type(exc).__name__}: {str(exc)[:120]}"

    source = "live" if models else "fallback"
    if not models:
        models = list(settings_service.model_options())

    return {
        "presets": list(settings_service.all_presets()),
        "source": source,
        "models": models,
        "error": error,
        "base_url": base_url,
    }


@router.delete("/config/{key}")
async def reset_config(
    key: str,
    _: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """把某个配置项恢复成 .env 默认值（删掉库里的覆盖记录）。"""
    known = {spec.key for spec in settings_service.all_specs()}
    if key not in known:
        raise HTTPException(status_code=400, detail=f"未知配置项：{key}")
    await config_repo.delete(db, key)
    return await settings_service.snapshot(db)