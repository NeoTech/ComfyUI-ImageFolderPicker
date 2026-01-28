"""
PNG Prompt Extractor Node for ComfyUI
Extracts embedded prompt metadata from PNG files
"""

import os
import json
from PIL import Image

# Console logging for debug
def log(msg):
    print(f"[PNGPromptExtractor] {msg}")


class PNGPromptExtractor:
    """
    A ComfyUI node that extracts prompt metadata from PNG files.
    Accepts a filepath from ImageFolderPicker.
    Returns the prompt as both raw JSON string and parsed string.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "filepath": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Full path to PNG file"
                }),
            },
            "optional": {},
        }
    
    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("prompt_json", "positive_prompt", "negative_prompt")
    OUTPUT_NODE = True
    FUNCTION = "extract_prompt"
    CATEGORY = "image"
    DESCRIPTION = "Extract embedded prompt metadata from PNG files. Connect filepath from ImageFolderPicker. Returns raw JSON, positive prompt, and negative prompt."
    
    def extract_prompt(self, filepath="", **kwargs):
        """
        Extract prompt from PNG metadata.
        
        Returns:
            dict: Contains 'result' tuple and 'ui' dict for display
        """
        log("=" * 50)
        log("extract_prompt() called")
        log(f"filepath: '{filepath}'")
        
        prompt_json = ""
        positive_prompt = ""
        negative_prompt = ""
        debug_info = []
        
        if not filepath:
            log("No filepath provided")
            debug_info.append(f"[DEBUG] filepath: '{filepath}'")
            return {"ui": {"text": debug_info + ["No filepath provided"]}, 
                    "result": (prompt_json, positive_prompt, negative_prompt)}
        
        debug_info.append(f"[DEBUG] filepath: '{filepath}'")
        log(f"filepath: '{filepath}'")
        
        if not os.path.exists(filepath):
            log(f"Path does not exist: {filepath}")
            debug_info.append(f"[DEBUG] Path does not exist")
            return {"ui": {"text": debug_info + ["File not found"]}, 
                    "result": (prompt_json, positive_prompt, negative_prompt)}
        
        log(f"File exists: {filepath}")
        debug_info.append(f"[DEBUG] File exists")
        
        # Check if file is a PNG
        if not filepath.lower().endswith('.png'):
            log("File does not end with .png")
            debug_info.append("[DEBUG] File does not end with .png")
            return {"ui": {"text": debug_info + ["File is not a PNG"]}, 
                    "result": (prompt_json, positive_prompt, negative_prompt)}
        
        try:
            with Image.open(filepath) as img:
                debug_info.append(f"[DEBUG] Image format: {img.format}")
                debug_info.append(f"[DEBUG] img.info keys: {list(img.info.keys())}")
                log(f"Image format: {img.format}, keys: {list(img.info.keys())}")
                
                if img.format != "PNG":
                    return {"ui": {"text": debug_info + ["File is not a valid PNG"]}, 
                            "result": (prompt_json, positive_prompt, negative_prompt)}
                
                # Extract prompt from PNG metadata
                if "prompt" in img.info:
                    prompt_json = img.info["prompt"]
                    debug_info.append(f"[DEBUG] Found 'prompt' key, length: {len(prompt_json)}")
                    log(f"Found 'prompt' key, length: {len(prompt_json)}")
                    
                    # Try to parse and extract positive prompt text
                    prompt_text = self._extract_prompt_text(prompt_json)
                    debug_info.append(f"[DEBUG] Extracted prompt_text length: {len(prompt_text)}")
                    
                    # Split on --- delimiter
                    positive_prompt, negative_prompt = self._split_prompt(prompt_text)
                
                # Also check for "parameters" key (used by some tools like A1111)
                elif "parameters" in img.info:
                    prompt_json = img.info["parameters"]
                    debug_info.append(f"[DEBUG] Found 'parameters' key, length: {len(prompt_json)}")
                    prompt_text = self._extract_a1111_prompt(prompt_json)
                    
                    # Split on --- delimiter
                    positive_prompt, negative_prompt = self._split_prompt(prompt_text)
                else:
                    debug_info.append("[DEBUG] No 'prompt' or 'parameters' key found")
                    return {"ui": {"text": debug_info + ["No prompt metadata found in PNG"]}, 
                            "result": (prompt_json, positive_prompt, negative_prompt)}
                    
        except Exception as e:
            debug_info.append(f"[DEBUG] Exception: {str(e)}")
            log(f"Exception: {str(e)}")
            return {"ui": {"text": debug_info + [f"Error reading file: {str(e)}"]}, 
                    "result": (prompt_json, positive_prompt, negative_prompt)}
        
        # Display the extracted prompts in UI
        display_lines = []
        if positive_prompt:
            display_lines.append(f"Positive: {positive_prompt[:100]}..." if len(positive_prompt) > 100 else f"Positive: {positive_prompt}")
        if negative_prompt:
            display_lines.append(f"Negative: {negative_prompt[:100]}..." if len(negative_prompt) > 100 else f"Negative: {negative_prompt}")
        if not display_lines:
            display_lines.append("No prompts extracted")
        
        return {"ui": {"text": debug_info + ["---"] + display_lines}, 
                "result": (prompt_json, positive_prompt, negative_prompt)}
    
    def _split_prompt(self, prompt_text):
        """
        Split combined prompt text into positive and negative prompts.
        Uses --- as delimiter (on its own line).
        
        Returns:
            tuple: (positive_prompt, negative_prompt)
        """
        if not prompt_text:
            return ("", "")
        
        # Split on --- delimiter (with newlines)
        parts = prompt_text.split("\n---\n")
        
        positive = parts[0].strip() if len(parts) > 0 else ""
        negative = parts[1].strip() if len(parts) > 1 else ""
        
        # If there are more than 2 parts, join the rest into negative
        if len(parts) > 2:
            negative = "\n---\n".join(parts[1:]).strip()
        
        return (positive, negative)
    
    def _extract_prompt_text(self, prompt_json):
        """
        Extract readable prompt text from ComfyUI JSON prompt format.
        Looks for CLIPTextEncode nodes and extracts the text.
        """
        try:
            prompt_data = json.loads(prompt_json)
            
            positive_prompts = []
            
            # ComfyUI prompt format: dict of node_id -> node_data
            for node_id, node_data in prompt_data.items():
                if not isinstance(node_data, dict):
                    continue
                
                class_type = node_data.get("class_type", "")
                inputs = node_data.get("inputs", {})
                
                # Look for text encoding nodes (positive prompts)
                if "CLIPTextEncode" in class_type:
                    text = inputs.get("text", "")
                    if text and isinstance(text, str):
                        positive_prompts.append(text)
            
            # Return first positive prompt found, or join all if multiple
            if positive_prompts:
                return positive_prompts[0] if len(positive_prompts) == 1 else "\n---\n".join(positive_prompts)
            
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
        
        return ""
    
    def _extract_a1111_prompt(self, parameters):
        """
        Extract prompt from A1111/WebUI style 'parameters' metadata.
        Format is typically: "positive prompt\nNegative prompt: negative\nSteps: ..."
        """
        try:
            # A1111 format: prompt is everything before "Negative prompt:" or metadata
            lines = parameters.split("\n")
            prompt_lines = []
            
            for line in lines:
                # Stop when we hit negative prompt or generation parameters
                if line.startswith("Negative prompt:") or line.startswith("Steps:"):
                    break
                prompt_lines.append(line)
            
            return "\n".join(prompt_lines).strip()
            
        except Exception:
            pass
        
        return ""
