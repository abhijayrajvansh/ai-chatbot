import {
  chatModels,
  getAllGatewayModels,
  getCapabilities,
  isDemo,
} from "@/lib/ai/models";

export async function GET() {
  const headers = {
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
  };

  const capabilities = getCapabilities();
  const models = await getAllGatewayModels();

  if (isDemo) {
    return Response.json({ capabilities, models }, { headers });
  }

  return Response.json({
    capabilities,
    models: models.length > 0 ? models : chatModels,
  }, { headers });
}
