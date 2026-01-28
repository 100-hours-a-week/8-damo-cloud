module.exports = {
  apps: [
    {
      name: "fastapi-app",
      cwd: "/home/ubuntu/opt/ai-prod/app",
      script: "/home/ubuntu/opt/ai-prod/app/.venv/bin/python",
      args: "-m uvicorn main:app --host 0.0.0.0 --port 8000",
      env: {
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
};
