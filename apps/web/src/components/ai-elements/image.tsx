import { cn } from "@upstand/ui/lib/utils";
import type { Experimental_GeneratedImage } from "ai";

export type ImageProps = Experimental_GeneratedImage & {
  className?: string;
  alt?: string;
};

export const Image = ({
  base64,
  uint8Array: _uint8Array,
  mediaType,
  ...props
}: ImageProps) => (
  // biome-ignore lint/performance/noImgElement: Generated images use data URLs and cannot be optimized by Next Image.
  <img
    {...props}
    alt={props.alt}
    className={cn(
      "h-auto max-w-full overflow-hidden rounded-md",
      props.className,
    )}
    src={`data:${mediaType};base64,${base64}`}
  />
);
