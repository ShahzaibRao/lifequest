"""LifeQuest configuration. All settings come from the environment.
JWT_SECRET must be set in backend/.env (generate: openssl rand -hex 32).
There is intentionally no default secret in code.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_name: str = "lifequest-api"
    app_version: str = "0.1.0"
    database_url: str = (
        "postgresql+psycopg://lifequest:lifequest-dev@localhost:5432/lifequest"
    )
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    google_client_id: str = ""
    google_android_client_id: str = ""
    google_ios_client_id: str = ""
    redis_url: str = "redis://redis:6379/0"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30


settings = Settings()

