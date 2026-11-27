"""NanoDet ONNX CPU inference, adapted from OpenCV Zoo's Apache-2.0 example.

Modified: bounded class-aware NMS, stable DFL softmax, original-frame normalized
coordinates and appearance descriptors. See LICENSE-NANODET.txt and NOTICE-NANODET.txt.
Reference: opencv/opencv_zoo@48b10fa505aeb51fbd127fc60a5c660040e823b7.
"""
import hashlib
import os
from pathlib import Path

MODEL_COMMIT = "48b10fa505aeb51fbd127fc60a5c660040e823b7"
MODEL_SHA256 = "4b82da9944b88577175ee23a459dce2e26e6e4be573def65b1055dc2d9720186"
MODEL_BYTES = 3800954
MODEL_URL = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{MODEL_COMMIT}/models/object_detection_nanodet/object_detection_nanodet_2022nov.onnx"
MODEL_NAME = "opencv-zoo-nanodet-m-plus-1.5x-416"
MODEL_VERSION = f"2022nov-{MODEL_COMMIT[:12]}"
CLASSES = ("person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
           "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
           "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
           "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
           "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
           "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
           "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
           "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
           "teddy bear", "hair drier", "toothbrush")


def model_path():
    return Path(os.getenv("TRACKING_MODEL_PATH") or Path(__file__).with_name("models") / "nanodet.onnx")


def verify_model(file):
    try:
        if file.stat().st_size != MODEL_BYTES:
            return False
        return hashlib.sha256(file.read_bytes()).hexdigest() == MODEL_SHA256
    except OSError:
        return False


class NanoDetDetector:
    def __init__(self, file=None, threshold=0.35):
        # Import only inside the isolated tracking worker. A missing CV package
        # must not prevent the existing STT/health service from starting.
        import cv2
        import numpy as np
        self.cv, self.np, self.threshold = cv2, np, threshold
        file = Path(file) if file is not None else model_path()
        if not verify_model(file):
            raise RuntimeError("TRACKING_MODEL_UNAVAILABLE")
        cv2.setNumThreads(1)
        # Buffer loading also supports Windows paths containing Korean text.
        self.net = cv2.dnn.readNetFromONNX(np.frombuffer(file.read_bytes(), dtype=np.uint8))
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        self.anchors = []
        for stride in (8, 16, 32, 64):
            yy, xx = np.mgrid[:416 // stride, :416 // stride]
            self.anchors.append(np.column_stack((xx.ravel(), yy.ravel())) * stride + 0.5 * (stride - 1))

    def detect(self, frame):
        cv, np = self.cv, self.np
        height, width = frame.shape[:2]
        scale = min(416 / width, 416 / height)
        resized_width, resized_height = max(1, int(width * scale)), max(1, int(height * scale))
        left, top = (416 - resized_width) // 2, (416 - resized_height) // 2
        rgb = cv.cvtColor(frame, cv.COLOR_BGR2RGB)
        resized = cv.resize(rgb, (resized_width, resized_height), interpolation=cv.INTER_AREA)
        image = cv.copyMakeBorder(resized, top, 416 - resized_height - top,
                                  left, 416 - resized_width - left, cv.BORDER_CONSTANT, value=0)
        image = (image.astype(np.float32) - np.array([103.53, 116.28, 123.675], dtype=np.float32))
        image /= np.array([57.375, 57.12, 58.395], dtype=np.float32)
        self.net.setInput(cv.dnn.blobFromImage(image))
        outputs = self.net.forward(self.net.getUnconnectedOutLayersNames())
        boxes, scores, labels = [], [], []
        for stride, anchors, cls, distances in zip((8, 16, 32, 64), self.anchors, outputs[::2], outputs[1::2]):
            cls, distances = cls.reshape(-1, 80), distances.reshape(-1, 4, 8)
            if len(cls) != len(anchors):
                raise RuntimeError("TRACKING_MODEL_OUTPUT_INVALID")
            confidence = cls.max(axis=1)
            eligible = np.flatnonzero(confidence >= self.threshold)
            eligible = eligible[np.argsort(confidence[eligible])[::-1]][:1000]
            if not len(eligible):
                continue
            logits = distances[eligible]
            probabilities = np.exp(logits - logits.max(axis=2, keepdims=True))
            probabilities /= probabilities.sum(axis=2, keepdims=True)
            decoded = (probabilities @ np.arange(8, dtype=np.float32)) * stride
            points = anchors[eligible]
            xyxy = np.column_stack((points[:, 0] - decoded[:, 0], points[:, 1] - decoded[:, 1],
                                    points[:, 0] + decoded[:, 2], points[:, 1] + decoded[:, 3]))
            xyxy = np.clip(xyxy, 0, 416)
            xyxy[:, [0, 2]] = np.clip((xyxy[:, [0, 2]] - left) / resized_width, 0, 1)
            xyxy[:, [1, 3]] = np.clip((xyxy[:, [1, 3]] - top) / resized_height, 0, 1)
            xyxy[:, 2:] -= xyxy[:, :2]
            for box, score, label in zip(xyxy, confidence[eligible], cls[eligible].argmax(axis=1)):
                if box[2] > 0 and box[3] > 0 and np.isfinite(box).all():
                    boxes.append(box.tolist())
                    scores.append(float(score))
                    labels.append(int(label))
        kept = []
        for label in sorted(set(labels)):
            members = [index for index, item in enumerate(labels) if item == label]
            local = cv.dnn.NMSBoxes([boxes[index] for index in members], [scores[index] for index in members], self.threshold, 0.6)
            kept.extend(members[int(index)] for index in np.asarray(local).reshape(-1))
        detections = []
        for index in sorted(kept, key=lambda item: -scores[item])[:12]:
            box = boxes[index]
            x1, y1 = int(box[0] * width), int(box[1] * height)
            x2, y2 = min(width, int((box[0] + box[2]) * width)), min(height, int((box[1] + box[3]) * height))
            region = frame[y1:y2, x1:x2]
            appearance = []
            if region.size:
                histogram = cv.calcHist([cv.cvtColor(region, cv.COLOR_BGR2HSV)], [0, 1], None, [8, 8], [0, 180, 0, 256]).ravel()
                total = float(histogram.sum())
                if total:
                    appearance = (histogram / total).tolist()
            detections.append({"classId": labels[index], "label": CLASSES[labels[index]],
                               "bbox": box, "confidence": scores[index], "appearance": appearance})
        return detections
