CREATE TABLE "PerformanceSample" (
    "id" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "rating" TEXT,
    "fingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PerformanceSample_route_metric_createdAt_idx"
ON "PerformanceSample"("route", "metric", "createdAt" DESC);

CREATE INDEX "PerformanceSample_createdAt_idx"
ON "PerformanceSample"("createdAt" DESC);
