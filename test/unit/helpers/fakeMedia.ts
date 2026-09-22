import type { CaptureConstraints, MediaPort } from "../../../src/core/ports";
import { FakeMediaStreamTrack } from "./fakeRtc";

export class FakeMediaPort implements MediaPort {
  cameraCalls: CaptureConstraints[] = [];
  screenCalls = 0;
  tracks: FakeMediaStreamTrack[] = [];
  rejectCamera: Error | undefined;
  rejectScreen: Error | undefined;
  async camera(c: CaptureConstraints): Promise<MediaStreamTrack> {
    this.cameraCalls.push({ ...c });
    if (this.rejectCamera) throw this.rejectCamera;
    const t = new FakeMediaStreamTrack();
    t.settings = { width: c.width, height: c.height, frameRate: c.frameRate };
    t.contentHint = "motion";
    this.tracks.push(t);
    return t.asTrack();
  }
  async screen(): Promise<MediaStreamTrack> {
    this.screenCalls++;
    if (this.rejectScreen) throw this.rejectScreen;
    const t = new FakeMediaStreamTrack();
    t.settings = { width: 2560, height: 1440, frameRate: 5 };
    t.contentHint = "detail";
    this.tracks.push(t);
    return t.asTrack();
  }
  last(): FakeMediaStreamTrack {
    const t = this.tracks[this.tracks.length - 1];
    if (!t) throw new Error("no track captured");
    return t;
  }
}
