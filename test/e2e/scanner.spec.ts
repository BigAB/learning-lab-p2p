import { chromium, test } from "@playwright/test";
import { expectState, openStudent, openTeacher, readPayload, tile } from "./helpers";
import { writeQrY4m } from "./qrVideo";

/**
 * Spec §8.2's real-scanner test: the student's offer QR is rendered into a video clip that
 * Chromium serves as the teacher's camera, so the teacher pairs through <Scanner> — frame grab,
 * QR decode, dedupe, decodeWire, acceptOffer — instead of the data-payload shortcut.
 */
test("teacher pairs a student by scanning its offer QR through a fake camera", async ({
  browser,
}) => {
  const s = await openStudent(browser, "11");
  const offer = await readPayload(s.page, "offer", "11");

  const clip = test.info().outputPath("offer-11.y4m");
  writeQrY4m(offer, clip);
  const cameraBrowser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${clip}`,
      "--allow-loopback-in-peer-connection",
    ],
  });
  try {
    const t = await openTeacher(cameraBrowser);
    await t.page.locator("[data-action='scan']").click();
    // No injection: the answer only appears if the camera frames were decoded into the offer.
    const answer = await readPayload(t.page, "answer", "11");
    await s.page.evaluate((w) => window.__lab!.inject(w), answer);
    await expectState(t.page, tile("11"), "connected");
    await expectState(s.page, "#student", "connected");
    await t.ctx.close();
  } finally {
    await cameraBrowser.close();
    await s.ctx.close();
  }
});
