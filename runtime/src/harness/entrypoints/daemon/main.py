import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def create_app() -> FastAPI:
    app = FastAPI(
        title="Audit Harness Local Daemon API",
        description="Local runtime API complying with ADR-006 (Python Monolith)",
        version="0.1.0",
    )

    # Chỉ allow localhost cho Local API (theo Blueprint)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:1420", "tauri://localhost"],  # Tauri domains
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health")
    def health_check():
        return {"status": "ok", "service": "harness-daemon", "version": "0.1.0"}
    
    return app

app = create_app()

if __name__ == "__main__":
    import uvicorn
    # Local API bind to loopback only (127.0.0.1)
    port = int(os.environ.get("PORT", "3000"))
    uvicorn.run("harness.entrypoints.daemon.main:app", host="127.0.0.1", port=port, reload=True)
