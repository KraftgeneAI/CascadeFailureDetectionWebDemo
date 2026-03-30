# Power Grid Digital Twin

A digital twin for power grid cascade failure detection, combining a physics-based simulator with a GNN prediction model.

## Prerequisites

- [Miniconda](https://docs.conda.io/en/latest/miniconda.html) or Anaconda
- Node.js >= 18 and npm
- Git (with SSH key configured for GitHub)

## 1. Clone with submodule

```bash
git clone --recurse-submodules git@github.com:KraftgeneAI/CascadeFailureDetectionWebDemo.git
cd CascadeFailureDetectionWebDemo
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

## 2. Backend

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

## 3. Frontend

In a separate terminal:

```bash
cd frontend
npm install
npm start
```

The app will open at `http://localhost:3000` and proxies API calls to port 8000.

## Project Structure

```
.
├── backend/                  # FastAPI backend
│   ├── main.py               # App entry point & routes
│   ├── requirements.txt
│   └── services/
│       ├── cascade.py        # Cascade simulation & GNN inference
│       ├── scenarios.py      # Scenario loading
│       └── topology.py       # Grid topology
├── frontend/                 # React + Tailwind frontend
│   └── src/
├── CascadeFailureDetection/  # Git submodule (branch: model_improvement)
│   ├── cascade_prediction/   # GNN model, data pipeline, inference
│   ├── checkpoints/          # Trained model weights
│   └── data/                 # Test scenarios & grid topology
```

## Notes

- The backend adds `CascadeFailureDetection/` to `sys.path` automatically — no install needed for the submodule.
- To update the submodule to the latest commit on `model_improvement`:
  ```bash
  git submodule update --remote CascadeFailureDetection
  ```
