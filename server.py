from fastapi import FastAPI
from typing import Dict, Any

app = FastAPI()

@app.get("/api/dashboard")
async def get_dashboard_data():
    return {
        "stats": {
            "totalArea": 1500, # hectares
            "avgMoisture": 65,
            "cropDistribution": [
                {"name": "Wheat", "value": 40},
                {"name": "Corn", "value": 35},
                {"name": "Soy", "value": 25},
            ],
        },
        "fields": [
            {"id": "1", "name": "Field North", "moistureLevel": 72, "growthStage": "vegetative", "stressLevel": "low", "advisory": "No action needed"},
            {"id": "2", "name": "Field South", "moistureLevel": 45, "growthStage": "flowering", "stressLevel": "high", "advisory": "Light irrigation recommended"},
        ],
    }

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
