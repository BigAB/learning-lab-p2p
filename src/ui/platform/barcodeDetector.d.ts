interface DetectedBarcode {
  rawValue: string;
  format: string;
}
declare class BarcodeDetector {
  constructor(opts?: { formats?: string[] });
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
