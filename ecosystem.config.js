module.exports = {
    apps: [
      {
        name: "Todo-401",
        script: "index.js",
        instances: "max",
        exec_mode: "cluster",
        err_file: "logs/error.log",
        out_file: "logs/output.log",
        log_file: "logs/merge.log",
        merge_logs: true,
        env_production: {
            NODE_ENV: "production",
            PORT: process.env.PORT || 4000,
        },
      },
    ],
  };