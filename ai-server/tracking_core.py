"""Bounded, class-aware association of observed boxes; no invented observations."""
import copy
import math


def iou(left, right):
    x = max(left[0], right[0])
    y = max(left[1], right[1])
    width = max(0.0, min(left[0] + left[2], right[0] + right[2]) - x)
    height = max(0.0, min(left[1] + left[3], right[1] + right[3]) - y)
    intersection = width * height
    union = left[2] * left[3] + right[2] * right[3] - intersection
    return intersection / union if union > 0 else 0.0


def center_distance(left, right):
    return math.hypot(left[0] + left[2] / 2 - right[0] - right[2] / 2,
                      left[1] + left[3] / 2 - right[1] - right[3] / 2)


def valid_detection(item):
    bbox = item.get("bbox", [])
    return (isinstance(item.get("classId"), int) and 0 <= item["classId"] < 80
            and isinstance(item.get("label"), str) and bool(item["label"])
            and len(bbox) == 4 and all(math.isfinite(value) for value in bbox)
            and bbox[0] >= 0 and bbox[1] >= 0 and bbox[2] > 0 and bbox[3] > 0
            and bbox[0] + bbox[2] <= 1.000001 and bbox[1] + bbox[3] <= 1.000001
            and math.isfinite(item.get("confidence", -1)) and 0 <= item["confidence"] <= 1)


class TrackAssembler:
    """Greedy motion/appearance matching within each shot, with explicit gaps."""

    def __init__(self, start, end, sample_fps, maximum_tracks=64):
        self.start, self.end, self.step = start, end, 1 / sample_fps
        self.maximum_tracks = maximum_tracks
        self.tracks, self.active, self.warnings = [], {}, []
        self.scenes = [{"id": "s1", "start": start, "end": end}]
        self._last_time = None
        self._warning_codes = set()
        self._track_sequence = 0
        self._scene_sequence = 1

    def warn(self, code, message, time=None):
        if code in self._warning_codes:
            return
        self._warning_codes.add(code)
        warning = {"code": code, "message": message}
        if time is not None:
            warning.update(start=time, end=time)
        self.warnings.append(warning)

    def _finish_active(self, until):
        for state in self.active.values():
            track = state["track"]
            gap_start = track["end"] + self.step / 2
            if until - gap_start >= self.step / 2:
                track["gaps"].append({"start": round(gap_start, 6), "end": round(until, 6)})
        self.active.clear()

    def update(self, time, detections, scene_cut=False):
        if not math.isfinite(time) or not self.start <= time < self.end:
            raise ValueError("Observation is outside the analysis range")
        if self._last_time is not None and time <= self._last_time:
            raise ValueError("Frame timestamps must be strictly increasing")
        self._last_time = time
        if scene_cut and time > self.scenes[-1]["start"]:
            self._finish_active(time)
            self.scenes[-1]["end"] = time
            self._scene_sequence += 1
            self.scenes.append({"id": f"s{self._scene_sequence}", "start": time, "end": self.end})
        detections = [item for item in detections if valid_detection(item)]
        detections = sorted(detections, key=lambda item: (-item["confidence"], item["classId"], item["bbox"][0]))[:12]
        maximum_gap = max(1.0, self.step * 2.1)
        for identity, state in list(self.active.items()):
            if time - state["track"]["end"] > maximum_gap:
                gap_start = state["track"]["end"] + self.step / 2
                state["track"]["gaps"].append({"start": round(gap_start, 6), "end": round(time, 6)})
                del self.active[identity]

        matches = []
        for identity, state in self.active.items():
            track = state["track"]
            last = track["observations"][-1]["bbox"]
            elapsed = time - track["end"]
            predicted = [last[0] + state["velocity"][0] * elapsed,
                         last[1] + state["velocity"][1] * elapsed, last[2], last[3]]
            for index, detection in enumerate(detections):
                if detection["classId"] != track["classId"]:
                    continue
                overlap = iou(predicted, detection["bbox"])
                distance = center_distance(predicted, detection["bbox"])
                appearance = 0.0
                if state["appearance"] and detection.get("appearance"):
                    appearance = sum(math.sqrt(max(0, a * b)) for a, b in zip(state["appearance"], detection["appearance"]))
                if overlap < 0.05 and not (distance < 0.12 and appearance > 0.7):
                    continue
                score = overlap * 0.65 + max(0.0, 1 - distance / 0.3) * 0.25 + appearance * 0.1
                matches.append((score, identity, index))
        matches.sort(key=lambda item: (-item[0], item[1], item[2]))
        claimed_tracks, claimed_detections = set(), set()
        for score, identity, index in matches:
            if identity in claimed_tracks or index in claimed_detections:
                continue
            if any(other_id != identity and other_index == index and abs(other_score - score) < 0.08
                   for other_score, other_id, other_index in matches):
                self.warn("AMBIGUOUS_IDENTITY", "겹치거나 교차하는 대상의 번호는 불확실할 수 있습니다. 원본 화면에서 확인해 주세요.", time)
            self._observe(self.active[identity], time, detections[index])
            claimed_tracks.add(identity)
            claimed_detections.add(index)
        for index, detection in enumerate(detections):
            if index in claimed_detections:
                continue
            if self.maximum_tracks is not None and len(self.tracks) >= self.maximum_tracks:
                self.warn("TRACK_LIMIT", "대상이 많아 최대 64개 트랙까지만 기록했습니다. 분석 구간을 줄여 주세요.", time)
                continue
            self._track_sequence += 1
            identity = f"t{self._track_sequence}"
            track = {"id": identity, "sceneId": self.scenes[-1]["id"], "classId": detection["classId"],
                     "label": detection["label"], "start": time, "end": time,
                     "meanConfidence": detection["confidence"], "observations": [], "gaps": []}
            state = {"track": track, "velocity": (0.0, 0.0), "appearance": detection.get("appearance", [])}
            self.tracks.append(track)
            self.active[identity] = state
            self._observe(state, time, detection)

    def _observe(self, state, time, detection):
        track = state["track"]
        if track["observations"]:
            previous = track["observations"][-1]
            elapsed = time - previous["time"]
            state["velocity"] = tuple((detection["bbox"][axis] - previous["bbox"][axis]) / elapsed for axis in (0, 1))
            if elapsed > self.step * 1.5:
                track["gaps"].append({"start": round(previous["time"] + self.step / 2, 6),
                                      "end": round(time - self.step / 2, 6)})
        track["end"] = round(time, 6)
        track["observations"].append({"time": round(time, 6), "bbox": [round(value, 7) for value in detection["bbox"]],
                                      "confidence": round(detection["confidence"], 6)})
        track["meanConfidence"] = round(sum(item["confidence"] for item in track["observations"]) / len(track["observations"]), 6)
        state["appearance"] = detection.get("appearance", [])

    def finish(self):
        self._finish_active(self.end)
        recommendations = []
        for scene in self.scenes:
            candidates = [track for track in self.tracks if track["sceneId"] == scene["id"]]
            if not candidates:
                continue
            def rank(track):
                mean_area = sum(item["bbox"][2] * item["bbox"][3] for item in track["observations"]) / len(track["observations"])
                return math.sqrt(mean_area) * len(track["observations"]) * track["meanConfidence"]
            best = max(candidates, key=rank)
            recommendations.append({"sceneId": scene["id"], "trackId": best["id"],
                                    "reason": "관측된 크기·등장 빈도·검출 신뢰도를 기준으로 추천했습니다. 의미상 중요도는 직접 확인해 주세요."})
        return {"scenes": self.scenes, "tracks": self.tracks, "recommendations": recommendations, "warnings": self.warnings}

    def window_result(self, start, end):
        """Export one committed window without terminating active identities."""
        if not self.start <= start < end <= self.end:
            raise ValueError("Invalid output window")
        scenes = [{"id": item["id"], "start": max(start, item["start"]), "end": min(end, item["end"])}
                  for item in self.scenes if item["start"] < end and item["end"] > start]
        scene_map = {item["id"]: item for item in scenes}
        tracks = []
        for track in self.tracks:
            observations = [item for item in track["observations"] if start <= item["time"] < end]
            if not observations or track["sceneId"] not in scene_map:
                continue
            scene = scene_map[track["sceneId"]]
            gaps = [{"start": max(scene["start"], gap["start"]), "end": min(scene["end"], gap["end"])}
                    for gap in track["gaps"] if gap["start"] < scene["end"] and gap["end"] > scene["start"]]
            tail = observations[-1]["time"] + self.step / 2
            if scene["end"] - tail >= self.step / 2 and not any(gap["start"] <= tail and gap["end"] >= scene["end"] for gap in gaps):
                gaps.append({"start": round(tail, 6), "end": scene["end"]})
            # A track is first marked absent when its association expires. At
            # export its final absence extends to the window/scene boundary;
            # these describe the same gap and must not become overlapping rows.
            merged = []
            for gap in sorted(gaps, key=lambda item: (item["start"], item["end"])):
                if merged and gap["start"] <= merged[-1]["end"]:
                    merged[-1]["end"] = max(merged[-1]["end"], gap["end"])
                else:
                    merged.append(dict(gap))
            gaps = merged
            tracks.append({"id": track["id"], "sceneId": track["sceneId"], "classId": track["classId"], "label": track["label"],
                           "start": observations[0]["time"], "end": observations[-1]["time"],
                           "meanConfidence": round(sum(item["confidence"] for item in observations) / len(observations), 6),
                           "observations": copy.deepcopy(observations), "gaps": gaps})
        recommendations = []
        for scene in scenes:
            candidates = [track for track in tracks if track["sceneId"] == scene["id"]]
            if candidates:
                best = max(candidates, key=lambda track: sum(math.sqrt(item["bbox"][2] * item["bbox"][3]) * item["confidence"] for item in track["observations"]))
                recommendations.append({"sceneId": scene["id"], "trackId": best["id"], "reason": "관측된 크기·등장 빈도·검출 신뢰도를 기준으로 추천했습니다. 의미상 중요도는 직접 확인해 주세요."})
        warnings = [copy.deepcopy(item) for item in self.warnings if "start" not in item or start <= item["start"] < end]
        return {"scenes": scenes, "tracks": tracks, "recommendations": recommendations, "warnings": warnings}

    def checkpoint(self):
        """Only active associations and two recent observations cross a window."""
        active = []
        for state in self.active.values():
            saved = copy.deepcopy(state)
            saved["track"]["observations"] = saved["track"]["observations"][-2:]
            saved["track"]["gaps"] = []
            active.append(saved)
        return {"version": 1, "start": self.start, "end": self.end, "sampleFps": 1 / self.step,
                "trackSequence": self._track_sequence, "sceneSequence": self._scene_sequence,
                "lastTime": self._last_time, "scene": copy.deepcopy(self.scenes[-1]),
                "active": active, "warningCodes": sorted(self._warning_codes)}

    @classmethod
    def from_checkpoint(cls, value):
        if not isinstance(value, dict) or value.get("version") != 1:
            raise ValueError("Unsupported tracking checkpoint")
        start, end, fps = value["start"], value["end"], value["sampleFps"]
        if not all(isinstance(item, (int, float)) and math.isfinite(item) for item in (start, end, fps)) or not 0 <= start < end <= 36000 or not .5 <= fps <= 4:
            raise ValueError("Invalid tracking checkpoint range")
        active = value.get("active")
        if not isinstance(active, list) or len(active) > 64:
            raise ValueError("Invalid active tracking checkpoint")
        instance = cls(start, end, fps, maximum_tracks=None)
        instance._track_sequence = int(value["trackSequence"])
        instance._scene_sequence = int(value["sceneSequence"])
        instance._last_time = value["lastTime"]
        instance.scenes = [copy.deepcopy(value["scene"])]
        instance._warning_codes = set(value.get("warningCodes", []))
        for state in copy.deepcopy(active):
            track = state["track"]
            observations = track.get("observations")
            if not isinstance(observations, list) or not 1 <= len(observations) <= 2 or len(state.get("appearance", [])) > 64 or len(state.get("velocity", [])) != 2:
                raise ValueError("Invalid active track")
            for observation in observations:
                if not valid_detection({**track, **observation}) or not start <= observation["time"] < end:
                    raise ValueError("Invalid checkpoint observation")
            if track["id"] in instance.active or track["sceneId"] != instance.scenes[-1]["id"]:
                raise ValueError("Invalid checkpoint identity")
            instance.active[track["id"]] = state
            instance.tracks.append(track)
        return instance
