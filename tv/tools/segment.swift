import Foundation
import Vision
import ImageIO
import CoreVideo

let catalogURL = URL(fileURLWithPath: CommandLine.arguments[1])
let selected = Set(CommandLine.arguments.dropFirst(2))
let catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: catalogURL)) as! [[String: Any]]
let directory = catalogURL.deletingLastPathComponent().appendingPathComponent(".cache/person-masks")
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for record in catalog where selected.contains(record["name"] as! String) {
    let url = URL(fileURLWithPath: record["source"] as! String)
    let source = CGImageSourceCreateWithURL(url as CFURL, nil)!
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
    let request = VNGeneratePersonSegmentationRequest()
    request.qualityLevel = .accurate
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8
    request.usesCPUOnly = true
    try VNImageRequestHandler(cgImage: image).perform([request])
    let buffer = request.results!.first!.pixelBuffer
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    let data = Data(bytes: CVPixelBufferGetBaseAddress(buffer)!, count: stride * height)
    CVPixelBufferUnlockBaseAddress(buffer, .readOnly)
    let provider = CGDataProvider(data: data as CFData)!
    let mask = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8,
                       bytesPerRow: stride, space: CGColorSpaceCreateDeviceGray(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
    let output = directory.appendingPathComponent((record["name"] as! String) + ".png")
    let destination = CGImageDestinationCreateWithURL(output as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, mask, nil)
    if !CGImageDestinationFinalize(destination) { fatalError("Cannot save mask") }
    print(output.path)
}
