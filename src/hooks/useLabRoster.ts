import { useEffect, useState } from "react";
import type { LabController } from "../core/labController";

function read(lab: LabController) {
  return {
    tiles: lab.snapshot(),
    queue: lab.repairQueue(),
    counts: lab.counts(),
    settings: lab.settings,
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
