from tracking_core import TrackAssembler, iou


def detection(x, class_id=0):
    return {"classId": class_id, "label": "person" if class_id == 0 else "car", "confidence": 0.9,
            "bbox": [x, 0.1, 0.2, 0.4], "appearance": [1.0, 0.0]}


def test_moving_observations_keep_identity_and_original_time():
    tracker = TrackAssembler(10, 12, 2)
    tracker.update(10, [detection(0.1)])
    tracker.update(10.5, [detection(0.14)])
    tracker.update(11, [detection(0.18)])
    result = tracker.finish()
    assert len(result["tracks"]) == 1
    assert [item["time"] for item in result["tracks"][0]["observations"]] == [10, 10.5, 11]
    assert result["tracks"][0]["observations"][-1]["bbox"][0] == 0.18


def test_two_targets_and_classes_are_not_collapsed():
    tracker = TrackAssembler(0, 2, 2)
    tracker.update(0, [detection(0.05), detection(0.65)])
    tracker.update(0.5, [detection(0.1), detection(0.6)])
    tracker.update(1, [detection(0.15, 2), detection(0.55)])
    result = tracker.finish()
    assert len(result["tracks"]) == 3
    assert result["tracks"][0]["classId"] == 0
    assert result["tracks"][2]["classId"] == 2
    assert len(result["tracks"][1]["observations"]) == 3


def test_cut_restarts_identity_in_a_new_scene():
    tracker = TrackAssembler(0, 2, 2)
    tracker.update(0, [detection(0.1)])
    tracker.update(0.5, [detection(0.12)], scene_cut=True)
    result = tracker.finish()
    assert len(result["scenes"]) == 2
    assert result["tracks"][0]["id"] != result["tracks"][1]["id"]
    assert result["scenes"][0]["end"] == result["scenes"][1]["start"] == 0.5


def test_missing_frames_create_gap_without_predicted_boxes():
    tracker = TrackAssembler(0, 3, 2)
    tracker.update(0, [detection(0.1)])
    tracker.update(0.5, [])
    tracker.update(1, [detection(0.12)])
    result = tracker.finish()
    assert len(result["tracks"]) == 1
    assert len(result["tracks"][0]["observations"]) == 2
    assert result["tracks"][0]["gaps"][0] == {"start": 0.25, "end": 0.75}


def test_long_loss_does_not_reidentify_or_invent_results():
    tracker = TrackAssembler(0, 4, 2)
    tracker.update(0, [detection(0.1)])
    tracker.update(2, [])
    tracker.update(2.5, [detection(0.1)])
    result = tracker.finish()
    assert len(result["tracks"]) == 2
    assert sum(len(track["observations"]) for track in result["tracks"]) == 2


def test_empty_and_invalid_detections_remain_empty():
    tracker = TrackAssembler(0, 1, 2)
    invalid = detection(float("nan"))
    tracker.update(0, [invalid])
    tracker.update(0.5, [])
    result = tracker.finish()
    assert result["tracks"] == result["recommendations"] == []
    assert len(result["scenes"]) == 1


def test_track_and_frame_limits_bound_result_size():
    tracker = TrackAssembler(0, 2, 2, maximum_tracks=2)
    tracker.update(0, [detection(0.1), detection(0.5), detection(0.7)])
    result = tracker.finish()
    assert len(result["tracks"]) == 2
    assert any(item["code"] == "TRACK_LIMIT" for item in result["warnings"])
    assert iou([0, 0, 1, 1], [0, 0, 1, 1]) == 1
