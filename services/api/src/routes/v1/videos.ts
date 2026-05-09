import { Router, Request, Response } from "express";
import { prisma } from "../../services/prisma";
import { runwayService } from "../../controllers/runway.controller";

export const videosRouter = Router();

// Model mapping: API model name → internal model name
const MODEL_MAP: Record<string, { internal: string; quality?: string }> = {
  "seedance-2.0":    { internal: "seedance_2" },
  "happyhorse-1.0":  { internal: "happyhorse_1_0" },
  "kling-standard":  { internal: "kling_3_0_standard", quality: "standard" },
  "kling-pro":       { internal: "kling_3_0_pro" },
};

const VALID_MODELS = Object.keys(MODEL_MAP);

// ---------------------------------------------------------------------------
// POST /videos/generations — create a video generation task
// ---------------------------------------------------------------------------
videosRouter.post(
  "/videos/generations",
  async (req: Request, res: Response) => {
    try {
      const { model, prompt, image_url, image_urls, video_url, duration, aspect_ratio, resolution, sound, explore_mode, cfg_scale } =
        req.body ?? {};

      if (!model || typeof model !== "string") {
        return res.status(400).json({
          error: { message: "Missing or invalid 'model' field.", type: "invalid_request_error" },
        });
      }

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({
          error: { message: "Missing or invalid 'prompt' field.", type: "invalid_request_error" },
        });
      }

      const mapping = MODEL_MAP[model];
      if (!mapping) {
        return res.status(400).json({
          error: {
            message: `Unsupported model '${model}'. Supported: ${VALID_MODELS.join(", ")}`,
            type: "invalid_request_error",
          },
        });
      }

      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({
          error: { message: "Authentication required.", type: "authentication_error" },
        });
      }

      const isSeedance = mapping.internal === "seedance_2";
      const isHappyHorse = mapping.internal === "happyhorse_1_0";
      const validHappyHorseRatios = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);
      const happyHorseAspectRatio = typeof aspect_ratio === "string" ? aspect_ratio.trim() : "";
      const happyHorseResolutionInput = typeof resolution === "string" ? resolution.trim().toLowerCase() : "";
      const happyHorseResolution = happyHorseResolutionInput === "720p" ? "720p" : "1080p";
      const validSeedanceResolutions = new Set(["480p", "720p", "1080p"]);
      const seedanceResolutionInput = typeof resolution === "string" ? resolution.trim().toLowerCase() : "";
      const seedanceResolution = validSeedanceResolutions.has(seedanceResolutionInput) ? seedanceResolutionInput : "720p";

      const job = await runwayService.createJob({
        prompt,
        mode: "gen3a_turbo",
        model: mapping.internal,
        quality: isHappyHorse ? happyHorseResolution : mapping.quality,
        duration: duration ?? 5,
        sound: isHappyHorse ? undefined : (isSeedance ? (sound ?? true) : (sound ?? false)),
        exploreMode: explore_mode ?? false,
        cfgScale: isHappyHorse ? undefined : cfg_scale,
        ...(image_url ? { imageUrl: image_url } : {}),
        ...(Array.isArray(image_urls) ? { imageUrls: image_urls } : {}),
        ...(!isHappyHorse && video_url ? { videoUrl: video_url } : {}),
        userId,
        resolution: isHappyHorse
          ? (validHappyHorseRatios.has(happyHorseAspectRatio) ? happyHorseAspectRatio : "9:16")
          : isSeedance
            ? seedanceResolution
          : aspect_ratio === "16:9" ? "1920x1080" : aspect_ratio === "9:16" ? "1080x1920" : undefined,
      });

      const prefix = model.startsWith("kling") ? "vgen_kling" : (model.startsWith("happyhorse") ? "vgen_happyhorse" : "vgen_seedance");

      return res.status(202).json({
        id: `${prefix}_${job.id}`,
        object: "video.generation",
        model,
        status: "pending",
        created: Math.floor(Date.now() / 1000),
        output: null,
        error: null,
      });
    } catch (err: any) {
      console.error("[POST /videos/generations] error:", err);
      return res.status(500).json({
        error: { message: err.message ?? "Internal server error", type: "server_error" },
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /videos/generations/:id — poll task status
// ---------------------------------------------------------------------------
videosRouter.get(
  "/videos/generations/:id",
  async (req: Request, res: Response) => {
    try {
      const fullId = req.params.id;

      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({
          error: { message: "Authentication required.", type: "authentication_error" },
        });
      }

      // All supported video models are stored in runway_jobs
      let jobId: string;
      let model: string;
      if (fullId.startsWith("vgen_seedance_")) {
        jobId = fullId.replace("vgen_seedance_", "");
        model = "seedance-2.0";
      } else if (fullId.startsWith("vgen_happyhorse_")) {
        jobId = fullId.replace("vgen_happyhorse_", "");
        model = "happyhorse-1.0";
      } else if (fullId.startsWith("vgen_kling_")) {
        jobId = fullId.replace("vgen_kling_", "");
        model = "kling-pro"; // default, will be refined from DB
      } else {
        return res.status(400).json({
          error: { message: `Unrecognized generation ID format: '${fullId}'.`, type: "invalid_request_error" },
        });
      }

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(jobId)) {
        return res.status(404).json({
          error: { message: "Generation not found.", type: "not_found_error" },
        });
      }

      const rows: any[] = await prisma.$queryRawUnsafe(
        "SELECT id, status, result_url, thumbnail_url, error_message, duration, created_at, progress, model_name FROM runway_jobs WHERE id = $1::uuid AND user_id = $2::uuid",
        jobId,
        userId
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          error: { message: "Generation not found.", type: "not_found_error" },
        });
      }

      const row = rows[0];

      // Refine model name from DB
      if (row.model_name === "seedance_2") model = "seedance-2.0";
      else if (row.model_name === "happyhorse_1_0") model = "happyhorse-1.0";
      else if (row.model_name === "kling_3_0_standard") model = "kling-standard";
      else if (row.model_name === "kling_3_0_pro") model = "kling-pro";

      const mappedStatus = mapStatus(row.status);
      const output =
        mappedStatus === "completed"
          ? {
              url: row.result_url,
              thumbnail_url: row.thumbnail_url,
              duration: row.duration,
            }
          : null;
      const error =
        mappedStatus === "failed"
          ? { message: row.error_message ?? "Generation failed" }
          : null;

      return res.json({
        id: fullId,
        object: "video.generation",
        model,
        status: mappedStatus,
        progress: row.progress ?? null,
        created: Math.floor(new Date(row.created_at).getTime() / 1000),
        output,
        error,
      });
    } catch (err: any) {
      console.error("[GET /videos/generations/:id] error:", err);
      return res.status(500).json({
        error: { message: err.message ?? "Internal server error", type: "server_error" },
      });
    }
  }
);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function mapStatus(
  raw: string
): "pending" | "processing" | "completed" | "failed" {
  switch (raw) {
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    case "pending":
      return "pending";
    default:
      return "processing";
  }
}
