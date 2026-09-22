import { useEffect, useState } from "react";
import type { LabController } from "../core/labController";

function read(lab: LabController) {
  const tiles = lab.snapshot();
  return {
    tiles,
    queue: lab.repairQueue(),
    counts: lab.counts(),
    settings: lab.settings,
    focused: lab.focused,
    broadcast: lab.broadcast.source,
    media: {
      on: tiles.filter((t) => t.media.cam === "on").length,
      cpuLimited: tiles.filter((t) => t.media.stats?.cpuLimited).length,
    },
  };
}

export function useLabRoster(lab: LabController) {
  const [v, setV] = useState(() => read(lab));
  useEffect(() => {
    setV(read(lab));
    return lab.on("change", () => setV(read(lab)));
  }, [lab]);
  return v;
}
