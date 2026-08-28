# MountainLore FastAPI backend

## Start locally

### Conda (recommended when Conda is already installed)

```powershell
conda create -n mountainlore-api python=3.12 -y
conda activate mountainlore-api
cd backend
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -i https://pypi.org/simple
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### `venv`

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -i https://pypi.org/simple
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`. Interactive documentation is at `http://localhost:8000/docs` and the health endpoint is `GET /api/v1/health`.

## Configuration

Copy `.env.example` to `.env` and adjust values as needed. The frontend development servers at ports 3000 are allowed by default.

## Test

```powershell
cd backend
pytest
```
