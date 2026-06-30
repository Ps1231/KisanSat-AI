export interface CropData {
  id: string;
  name: string;
  moistureLevel: number; // 0-100
  growthStage: 'germination' | 'vegetative' | 'flowering' | 'maturing';
  stressLevel: 'low' | 'moderate' | 'high';
  advisory: string;
}

export interface DashboardStats {
  totalArea: number;
  avgMoisture: number;
  cropDistribution: { name: string; value: number }[];
  etRate: number;
  waterDeficit: 'Low' | 'Moderate' | 'High';
}

export interface WeatherData {
  day: string;
  temp: number;
  condition: string;
  waterNeeds: 'Low' | 'Moderate' | 'High';
}

export interface SoilHealth {
  date: string;
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  salinity: number;
}
