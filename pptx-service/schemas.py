"""Pydantic models for PPTX generation input validation."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field


class Bullet(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    level: int = Field(default=0, ge=0, le=2)


class CoverSlide(BaseModel):
    type: Literal["cover"]
    title: str = Field(..., min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=300)
    date: str | None = Field(default=None, max_length=100)
    presenter: str | None = Field(default=None, max_length=100)


class ContentSlide(BaseModel):
    type: Literal["content"]
    title: str = Field(..., min_length=1, max_length=200)
    bullets: list[Bullet] = Field(..., min_length=1, max_length=8)
    notes: str | None = Field(default=None, max_length=500)


class SectionDividerSlide(BaseModel):
    type: Literal["section_divider"]
    section_number: str = Field(default="", max_length=10)
    title: str = Field(..., min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=300)


class ComparisonColumn(BaseModel):
    heading: str = Field(..., min_length=1, max_length=200)
    points: list[str] = Field(..., min_length=1, max_length=6)


class ComparisonSlide(BaseModel):
    type: Literal["comparison"]
    title: str = Field(..., min_length=1, max_length=200)
    left: ComparisonColumn
    right: ComparisonColumn


class ChartSeries(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    values: list[float] = Field(..., min_length=1, max_length=12)


class ChartSlide(BaseModel):
    type: Literal["chart"]
    title: str = Field(..., min_length=1, max_length=200)
    chart_type: Literal["bar", "line", "pie"]
    categories: list[str] = Field(..., min_length=1, max_length=12)
    series: list[ChartSeries] = Field(..., min_length=1, max_length=4)
    insight: str | None = Field(default=None, max_length=500)


class ClosingSlide(BaseModel):
    type: Literal["closing"]
    title: str = Field(..., min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=300)
    contact: str | None = Field(default=None, max_length=300)


Slide = Annotated[
    CoverSlide | ContentSlide | SectionDividerSlide | ComparisonSlide | ChartSlide | ClosingSlide,
    Field(discriminator="type"),
]


class SlideMeta(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=300)
    presenter: str | None = Field(default=None, max_length=100)
    date: str | None = Field(default=None, max_length=100)


class GenerateRequest(BaseModel):
    template: str = Field(default="corporate", min_length=1, max_length=50)
    meta: SlideMeta
    slides: list[Slide] = Field(..., min_length=1, max_length=30)
