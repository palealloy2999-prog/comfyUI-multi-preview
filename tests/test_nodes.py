import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock


class PreviewImageStub:
    def save_images(self, images, filename_prefix="ComfyUI", prompt=None, extra_pnginfo=None):
        return {
            "ui": {
                "images": [
                    {
                        "filename": f"{filename_prefix}.png",
                        "subfolder": "",
                        "type": "temp",
                    }
                ]
            }
        }


core_nodes = types.ModuleType("nodes")
core_nodes.PreviewImage = PreviewImageStub

prompt_server = Mock()
server = types.ModuleType("server")
server.PromptServer = types.SimpleNamespace(instance=prompt_server)

module_path = Path(__file__).parents[1] / "nodes.py"
spec = importlib.util.spec_from_file_location("multi_preview_nodes_under_test", module_path)
multi_preview_nodes = importlib.util.module_from_spec(spec)

original_nodes_module = sys.modules.get("nodes")
original_server_module = sys.modules.get("server")
sys.modules["nodes"] = core_nodes
sys.modules["server"] = server
try:
    spec.loader.exec_module(multi_preview_nodes)
finally:
    if original_nodes_module is None:
        del sys.modules["nodes"]
    else:
        sys.modules["nodes"] = original_nodes_module
    if original_server_module is None:
        del sys.modules["server"]
    else:
        sys.modules["server"] = original_server_module


class MultiPreviewTests(unittest.TestCase):
    def setUp(self):
        self.node = multi_preview_nodes.MultiPreview()

    def test_schema_requests_unique_id(self):
        self.assertEqual(self.node.INPUT_TYPES()["hidden"]["unique_id"], "UNIQUE_ID")

    def test_parent_skips_duplicate_save_when_receiver_is_in_prompt(self):
        self.node._save_pin_images = Mock()
        prompt = {
            "7": {"class_type": "MultiPreview", "inputs": {"image1": ["1", 0]}},
            "8": {
                "class_type": "MultiPreviewInternalReceiver",
                "inputs": {"image": ["1", 0], "parent_id": "7", "pin": 1},
            },
        }

        result = self.node.preview(prompt=prompt, unique_id="7", image1=object())

        self.node._save_pin_images.assert_not_called()
        self.assertEqual(result, {"ui": {"mp_version": [multi_preview_nodes.VERSION]}})

    def test_parent_keeps_save_fallback_without_injected_receiver(self):
        self.node._save_pin_images = Mock(
            return_value=[{"filename": "preview.png", "subfolder": "", "type": "temp"}]
        )

        result = self.node.preview(prompt={}, unique_id="7", image1=object())

        self.node._save_pin_images.assert_called_once()
        self.assertEqual(result["ui"]["mp_images"][0]["1"][0]["filename"], "preview.png")

    def test_hierarchical_parent_id_matches_receiver(self):
        self.node._save_pin_images = Mock()
        prompt = {
            "20": {
                "class_type": "MultiPreviewInternalReceiver",
                "inputs": {"image": ["1", 0], "parent_id": "3:7", "pin": 1},
            }
        }

        self.node.preview(prompt=prompt, unique_id="3:7", image1=object())

        self.node._save_pin_images.assert_not_called()

    def test_receiver_for_another_parent_does_not_disable_fallback(self):
        self.node._save_pin_images = Mock(
            return_value=[{"filename": "preview.png", "subfolder": "", "type": "temp"}]
        )
        prompt = {
            "8": {
                "class_type": "MultiPreviewInternalReceiver",
                "inputs": {"image": ["1", 0], "parent_id": "9", "pin": 1},
            }
        }

        self.node.preview(prompt=prompt, unique_id="7", image1=object())

        self.node._save_pin_images.assert_called_once()

    def test_missing_images_still_raise(self):
        with self.assertRaisesRegex(RuntimeError, "Required input is missing: images"):
            self.node.preview(prompt={}, unique_id="7")

    def test_receiver_preserves_hierarchical_parent_id_and_uses_safe_filename(self):
        prompt_server.reset_mock()
        receiver = multi_preview_nodes.MultiPreviewInternalReceiver()

        result = receiver.receive(object(), parent_id="3:7", pin=2)

        payload = result["ui"]["mp_receiver"][0]
        self.assertEqual(payload["parent_id"], "3:7")
        self.assertEqual(
            payload["images"][0]["filename"],
            "MultiPreviewInternalReceiver_parent3_7_pin2.png",
        )
        prompt_server.send_sync.assert_called_once_with("multi_preview_receiver", payload)


if __name__ == "__main__":
    unittest.main()
