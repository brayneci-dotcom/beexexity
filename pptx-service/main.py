"""PPTX Generation Microservice — FastAPI app."""
from __future__ import annotations

import traceback

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import Response

from generator import generate
from schemas import GenerateRequest

app = FastAPI(title="beexexity-pptx-service", version="1.0.0")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/generate")
async def generate_pptx(request: GenerateRequest):
    """Generate a .pptx file from Content JSON."""
    try:
        pptx_bytes = generate(request)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PPTX generation failed: {e}",
        ) from e

    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": "attachment; filename=presentation.pptx"},
    )
