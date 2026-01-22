module.exports = {
  apps: [
    {
      name: "fastapi-app",
      cwd: "/home/ubuntu/opt/ai-prod/app",
      script: "/home/ubuntu/.local/bin/uvicorn",
      args: "app.main:app --host 0.0.0.0 --port 8000",
      interpreter: "none",
      autorestart: true
    }
  ]
};