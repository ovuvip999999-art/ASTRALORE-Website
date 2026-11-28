$ErrorActionPreference = "Stop"

Write-Host "ASTRA model-server checks (API/scaffold only; no model weights or GPU required)" -ForegroundColor Cyan

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    throw "Python was not found. Install Python 3.12 or newer, then reopen PowerShell."
}

python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)"
if ($LASTEXITCODE -ne 0) {
    throw "Python 3.12 or newer is required."
}

if (-not (Test-Path ".venv")) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Could not create the virtual environment." }
}

$venvPython = Join-Path (Get-Location) ".venv\Scripts\python.exe"
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Could not update pip." }

& $venvPython -m pip install -r requirements-dev.txt
if ($LASTEXITCODE -ne 0) { throw "Could not install model-server test dependencies." }

& $venvPython -m py_compile app.py test_app.py test_http_api.py creative_brief.py test_creative_brief.py model_registry.py test_model_registry.py job_lifecycle.py test_job_lifecycle.py queue_store.py test_queue_store.py test_queue_migration.py test_queue_postgres.py quality_eval.py test_quality_eval.py
if ($LASTEXITCODE -ne 0) { throw "Python compilation failed." }

& $venvPython -m unittest -v
if ($LASTEXITCODE -ne 0) { throw "ASTRA model-server tests failed." }

Write-Host "All ASTRA model-server checks passed." -ForegroundColor Green
Write-Host "No model weights were downloaded and no generation was run."
