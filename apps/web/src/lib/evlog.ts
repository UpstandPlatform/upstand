import type { DrainContext } from "evlog";
import { createFsDrain } from "evlog/fs";
import { createEvlog } from "evlog/next";
import { createInstrumentation } from "evlog/next/instrumentation/create";
import { createOTLPDrain } from "evlog/otlp";

const fileDrain = createFsDrain({ maxFiles: 7 });
const otlpEndpoint =
  process.env.OTLP_ENDPOINT?.trim() ||
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const otlpDrain = otlpEndpoint
  ? createOTLPDrain({
      endpoint: otlpEndpoint,
      serviceName: "upstand-web",
    })
  : undefined;

const drain = async (context: DrainContext | DrainContext[]) => {
  await Promise.allSettled([
    fileDrain(context),
    ...(otlpDrain ? [otlpDrain(context)] : []),
  ]);
};

export const { withEvlog, useLogger, log, createError } = createEvlog({
  service: "upstand-web",
  drain,
});

export const { register, onRequestError } = createInstrumentation({
  service: "upstand-web",
});
