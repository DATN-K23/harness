import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Re-export Base để các module khác có thể import từ một điểm duy nhất
from harness.modules.persistence.models import Base  # noqa: F401

__all__ = ["engine", "SessionLocal", "get_db", "Base"]

# Lấy URL kết nối DB từ môi trường, mặc định kết nối vào SQLite cục bộ (Desktop App)
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "sqlite:///./audit_harness.db"
)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

# Khởi tạo engine
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,  # Kiểm tra kết nối trước khi sử dụng từ pool
    echo=os.environ.get("DB_ECHO", "false").lower() == "true",
)

# Khởi tạo session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Dependency injection cho FastAPI"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
