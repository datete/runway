import { Router } from "express";
import { apiKeyAuthMiddleware } from "../../middleware/apiKeyAuth";
import { apiKeyRateLimitMiddleware } from "../../middleware/apiKeyRateLimit";
import { apiCallLoggerMiddleware } from "../../middleware/apiCallLogger";
import { videosRouter } from "./videos";

const v1Router = Router();

// Apply API key auth to all /v1 routes
v1Router.use(apiKeyAuthMiddleware);
v1Router.use(apiKeyRateLimitMiddleware);
v1Router.use(apiCallLoggerMiddleware);

// Mount sub-routers
v1Router.use(videosRouter);

// GET /v1/models
v1Router.get("/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: "seedance-2.0",
        object: "model",
        owned_by: "seedream",
        type: "video",
        description: "Seedance 2.0 video generation",
      },
      {
        id: "kling-pro",
        object: "model",
        owned_by: "kling",
        type: "video",
        description: "Kling 3.0 Pro video generation",
      },
      {
        id: "kling-standard",
        object: "model",
        owned_by: "kling",
        type: "video",
        description: "Kling 3.0 Standard video generation",
      },
    ],
  });
});

export { v1Router };
