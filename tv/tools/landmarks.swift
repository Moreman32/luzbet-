import Foundation
import Vision
import ImageIO

let catalogURL = URL(fileURLWithPath: CommandLine.arguments[1])
var catalog = try JSONSerialization.jsonObject(with: Data(contentsOf: catalogURL)) as! [[String: Any]]
for i in catalog.indices {
    let url = URL(fileURLWithPath: catalog[i]["source"] as! String)
    let source = CGImageSourceCreateWithURL(url as CFURL, nil)!
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
    let request = VNDetectFaceLandmarksRequest()
    request.usesCPUOnly = true
    try VNImageRequestHandler(cgImage: image).perform([request])
    guard let face = request.results?.max(by: { $0.boundingBox.width < $1.boundingBox.width }),
          let landmarks = face.landmarks,
          let lips = landmarks.outerLips,
          let left = landmarks.leftEye, let right = landmarks.rightEye else {
        fatalError("Missing landmarks: \(url)")
    }
    func roi(_ regions: [VNFaceLandmarkRegion2D], padX: Double, padY: Double) -> [Int] {
        var points: [CGPoint] = []
        let box = face.boundingBox
        for region in regions {
            for point in region.normalizedPoints {
                let px = box.minX + CGFloat(point.x) * box.width
                let py = box.minY + CGFloat(point.y) * box.height
                points.append(CGPoint(x: px * 1920.0, y: (1.0 - py) * 1080.0))
            }
        }
        let x = max(0, Int(floor(points.map { $0.x }.min()! - padX)))
        let y = max(0, Int(floor(points.map { $0.y }.min()! - padY)))
        let x2 = min(1920, Int(ceil(points.map { $0.x }.max()! + padX)))
        let y2 = min(1080, Int(ceil(points.map { $0.y }.max()! + padY)))
        return [x, y, x2 - x, y2 - y]
    }
    catalog[i]["mouthROI"] = roi([lips], padX: 18, padY: 28)
    catalog[i]["eyesROI"] = roi([left, right], padX: 12, padY: 18)
}
let output = try JSONSerialization.data(withJSONObject: catalog, options: [.prettyPrinted, .sortedKeys])
try output.write(to: catalogURL)
print("Detected mouth and eye regions for \(catalog.count) poses")
