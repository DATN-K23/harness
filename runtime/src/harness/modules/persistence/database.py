import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Lấy URL kết nối DB từ môi trường, mặc định kết nối vào SQLite cục bộ (Desktop App)
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "sqlite:///./audit_harness.db"
)

# Khởi tạo engine (với SQLite cần check_same_thread=False)
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
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
