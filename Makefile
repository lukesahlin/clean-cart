.PHONY: install install-backend install-frontend \
        dev backend frontend \
        test lint clean help

# ── Default target ────────────────────────────────────────────────────────────
help:
	@echo.
	@echo   Clean Cart — available commands:
	@echo.
	@echo   make install          Install all backend + frontend dependencies
	@echo   make install-backend  Install Python dependencies only
	@echo   make install-frontend Install npm dependencies only
	@echo.
	@echo   make backend          Start the FastAPI server  (localhost:8000)
	@echo   make frontend         Start the Vite dev server (localhost:5173)
	@echo.
	@echo   make test             Run backend tests
	@echo   make clean            Remove node_modules and __pycache__
	@echo.

# ── Install ───────────────────────────────────────────────────────────────────
install: install-backend install-frontend

install-backend:
	cd backend && pip install -r requirements.txt

install-frontend:
	cd frontend && npm install

# ── Run ───────────────────────────────────────────────────────────────────────
backend:
	cd backend && uvicorn main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

# ── Test ──────────────────────────────────────────────────────────────────────
test:
	cd backend && python -m pytest test_filter_engine.py -v

# ── Clean ─────────────────────────────────────────────────────────────────────
clean:
	if exist frontend\node_modules rd /s /q frontend\node_modules
	for /d /r backend %%d in (__pycache__) do @if exist "%%d" rd /s /q "%%d"
	for /d /r backend %%d in (.pytest_cache) do @if exist "%%d" rd /s /q "%%d"
