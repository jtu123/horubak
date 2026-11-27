from tracking_core import TrackAssembler


def detection(x=0.1):
    return {"classId": 0, "label": "person", "confidence": .9, "bbox": [x, .1, .2, .4], "appearance": [1., 0.]}


def test_checkpoint_keeps_identity_velocity_and_original_timestamps_across_windows():
    tracker = TrackAssembler(0, 180, 2, maximum_tracks=None)
    for time, x in [(59, .10), (59.5, .12)]:
        tracker.update(time, [detection(x)])
    first = tracker.window_result(0, 60)
    assert first['tracks'][0]['id'] == 't1'
    restored = TrackAssembler.from_checkpoint(tracker.checkpoint())
    restored.update(60, [detection(.14)])
    restored.update(60.5, [detection(.16)])
    second = restored.window_result(60, 120)
    assert [track['id'] for track in second['tracks']] == ['t1']
    assert [item['time'] for item in second['tracks'][0]['observations']] == [60, 60.5]
    assert second['tracks'][0]['start'] == 60
    assert second['scenes'] == [{'id': 's1', 'start': 60, 'end': 120}]


def test_completed_tracks_are_flushed_without_a_64_track_lifetime_limit():
    tracker = TrackAssembler(0, 600, 2, maximum_tracks=None)
    all_ids = set()
    for index in range(100):
        start = index * 6
        tracker.update(start, [detection()], scene_cut=index > 0)
        window = tracker.window_result(start, start + 6)
        all_ids.add(window['tracks'][0]['id'])
        tracker = TrackAssembler.from_checkpoint(tracker.checkpoint())
        assert len(tracker.tracks) <= 1
        assert len(tracker.scenes) == 1
    assert len(all_ids) == 100
    assert 't100' in all_ids
    assert not any(w['code'] == 'TRACK_LIMIT' for w in tracker.warnings)


def test_scene_sequence_and_empty_windows_survive_checkpoint():
    tracker = TrackAssembler(0, 180, 2, maximum_tracks=None)
    tracker.update(0, [detection()])
    tracker.update(.5, [detection()], scene_cut=True)
    tracker = TrackAssembler.from_checkpoint(tracker.checkpoint())
    tracker.update(60, [], scene_cut=True)
    tracker.update(60.5, [])
    window = tracker.window_result(60, 120)
    assert window['scenes'] == [{'id': 's3', 'start': 60, 'end': 120}]
    assert window['tracks'] == []


def test_window_serializes_only_its_observations_and_clips_gaps():
    tracker = TrackAssembler(0, 180, 2, maximum_tracks=None)
    tracker.update(59.5, [detection()])
    tracker.update(60, [])
    tracker.update(60.5, [detection(.12)])
    window = tracker.window_result(60, 120)
    track = window['tracks'][0]
    assert track['start'] == track['end'] == 60.5
    assert all(60 <= gap['start'] < gap['end'] <= 120 for gap in track['gaps'])
    assert [item['time'] for item in track['observations']] == [60.5]


def test_export_merges_expired_track_gap_with_trailing_absence_without_overlap():
    tracker = TrackAssembler(0, 180, 2, maximum_tracks=None)
    tracker.update(0, [detection()])
    tracker.update(.5, [])
    tracker.update(1, [detection(.12)])
    tracker.update(2.5, [])
    window = tracker.window_result(0, 60)
    assert window['tracks'][0]['gaps'] == [
        {'start': .25, 'end': .75}, {'start': 1.25, 'end': 60}]
    gaps = window['tracks'][0]['gaps']
    assert all(previous['end'] <= current['start'] for previous, current in zip(gaps, gaps[1:]))
