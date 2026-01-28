"""
PNG Prompt Extractor Node for ComfyUI
Extracts embedded prompt metadata from PNG files
"""

import os
import json
import re
from PIL import Image


class PNGPromptExtractor:
    """
    A ComfyUI node that extracts prompt metadata from PNG files.
    Accepts a filepath from ImageFolderPicker.
    Returns prompts and generation parameters.
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
    
    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("prompt_json", "positive_prompt", "negative_prompt", "sampler", "scheduler", "cfg", "seed")
    OUTPUT_NODE = True
    FUNCTION = "extract_prompt"
    CATEGORY = "image"
    DESCRIPTION = "Extract embedded prompt metadata from PNG files. Connect filepath from ImageFolderPicker. Returns prompts and generation parameters."
    
    def extract_prompt(self, filepath="", **kwargs):
        """Extract prompt and parameters from PNG metadata."""
        prompt_json = ""
        positive_prompt = ""
        negative_prompt = ""
        sampler = ""
        scheduler = ""
        cfg = ""
        seed = ""
        
        # Validate input
        if not filepath or not os.path.exists(filepath) or not filepath.lower().endswith('.png'):
            return {"ui": {"text": ["Invalid or missing PNG file"]}, 
                    "result": (prompt_json, positive_prompt, negative_prompt, sampler, scheduler, cfg, seed)}
        
        try:
            with Image.open(filepath) as img:
                if img.format != "PNG":
                    return {"ui": {"text": ["File is not a valid PNG"]}, 
                            "result": (prompt_json, positive_prompt, negative_prompt, sampler, scheduler, cfg, seed)}
                
                # ComfyUI format (JSON workflow)
                if "prompt" in img.info:
                    prompt_json = img.info["prompt"]
                    positive_prompt, negative_prompt = self._extract_comfyui_prompts(prompt_json)
                    sampler, scheduler, cfg, seed = self._extract_comfyui_params(prompt_json)
                
                # A1111/WebUI format (text parameters)
                elif "parameters" in img.info:
                    params_text = img.info["parameters"]
                    prompt_json = json.dumps({"parameters": params_text})
                    positive_prompt, negative_prompt = self._extract_a1111_prompts(params_text)
                    sampler, scheduler, cfg, seed = self._extract_a1111_params(params_text)
                else:
                    return {"ui": {"text": ["No prompt metadata found in PNG"]}, 
                            "result": (prompt_json, positive_prompt, negative_prompt, sampler, scheduler, cfg, seed)}
                    
        except Exception as e:
            return {"ui": {"text": [f"Error: {str(e)}"]}, 
                    "result": (prompt_json, positive_prompt, negative_prompt, sampler, scheduler, cfg, seed)}
        
        # Display UI
        display_lines = []
        if positive_prompt:
            display_lines.append(f"Pos: {positive_prompt[:80]}..." if len(positive_prompt) > 80 else f"Pos: {positive_prompt}")
        if negative_prompt:
            display_lines.append(f"Neg: {negative_prompt[:80]}..." if len(negative_prompt) > 80 else f"Neg: {negative_prompt}")
        if any([sampler, scheduler, cfg, seed]):
            params = " | ".join(filter(None, [
                f"Sampler: {sampler}" if sampler else None,
                f"Scheduler: {scheduler}" if scheduler else None,
                f"CFG: {cfg}" if cfg else None,
                f"Seed: {seed}" if seed else None
            ]))
            if params:
                display_lines.append(params)
        
        return {"ui": {"text": display_lines if display_lines else ["No data extracted"]}, 
                "result": (prompt_json, positive_prompt, negative_prompt, sampler, scheduler, cfg, seed)}
    
    def _extract_a1111_prompts(self, params_text):
        """Extract positive and negative prompts from A1111 parameters using regex."""
        # Split at "Negative prompt:" marker
        neg_match = re.search(r'\nNegative prompt:\s*(.+?)(?=\nSteps:|$)', params_text, re.DOTALL)
        positive = re.split(r'\nNegative prompt:', params_text, maxsplit=1)[0].strip()
        negative = neg_match.group(1).strip() if neg_match else ""
        
        return (positive, negative)
    
    def _extract_a1111_params(self, params_text):
        """Extract generation parameters from A1111 metadata using regex."""
        sampler = re.search(r'Sampler:\s*([^,\n]+)', params_text)
        scheduler = re.search(r'Schedule type:\s*([^,\n]+)', params_text)
        cfg = re.search(r'CFG scale:\s*([\d.]+)', params_text)
        seed = re.search(r'Seed:\s*(\d+)', params_text)
        
        return (
            sampler.group(1).strip() if sampler else "",
            scheduler.group(1).strip() if scheduler else "",
            cfg.group(1).strip() if cfg else "",
            seed.group(1).strip() if seed else ""
        )
    
    def _extract_comfyui_prompts(self, prompt_json):
        """Extract prompts from ComfyUI JSON workflow."""
        try:
            workflow = json.loads(prompt_json)
            
            # Find conditioning nodes connected to samplers
            used_positive, used_negative = self._find_used_conditioning_nodes(workflow)
            
            # Follow conditioning chains to find actual text nodes
            actual_positive = {self._follow_conditioning_chain(node_id, workflow) 
                             for node_id in used_positive}
            actual_negative = {self._follow_conditioning_chain(node_id, workflow) 
                             for node_id in used_negative}
            actual_positive.discard(None)
            actual_negative.discard(None)
            
            # Extract text from nodes
            positive_texts = [self._extract_text_from_node(node_id, workflow) 
                            for node_id in actual_positive]
            negative_texts = [self._extract_text_from_node(node_id, workflow) 
                            for node_id in actual_negative]
            
            positive = "\n".join(filter(None, positive_texts))
            negative = "\n".join(filter(None, negative_texts))
            
            return (positive, negative)
        except:
            return ("", "")
    
    def _extract_comfyui_params(self, prompt_json):
        """Extract generation parameters from ComfyUI JSON workflow."""
        try:
            workflow = json.loads(prompt_json)
            sampler = ""
            scheduler = ""
            cfg = ""
            seed = ""
            
            for node_id, node_data in workflow.items():
                if not isinstance(node_data, dict):
                    continue
                
                class_type = node_data.get("class_type", "")
                inputs = node_data.get("inputs", {})
                
                # Sampler extraction
                if not sampler and "sampler_name" in inputs:
                    sampler = str(inputs["sampler_name"])
                
                # Scheduler extraction - use regex to match any node with Scheduler in name
                if not scheduler and re.search(r'Scheduler', class_type, re.IGNORECASE):
                    for key in ["scheduler", "scheduler_name"]:
                        if key in inputs:
                            scheduler = str(inputs[key])
                            break
                
                # CFG extraction
                if not cfg:
                    for key in ["cfg", "guidance", "guidance_scale"]:
                        if key in inputs:
                            cfg = str(inputs[key])
                            break
                
                # Seed extraction
                if not seed:
                    for key in ["seed", "noise_seed"]:
                        if key in inputs:
                            seed = str(inputs[key])
                            break
            
            return (sampler, scheduler, cfg, seed)
        except:
            return ("", "", "", "")
    
    def _find_used_conditioning_nodes(self, workflow):
        """Find which conditioning nodes are actually connected to samplers."""
        used_positive = set()
        used_negative = set()
        
        for node_id, node_data in workflow.items():
            if not isinstance(node_data, dict):
                continue
            
            class_type = node_data.get("class_type", "")
            inputs = node_data.get("inputs", {})
            
            # Check if this is a sampler node using regex
            if re.search(r'Sampler|sampler', class_type):
                # Direct positive/negative
                if "positive" in inputs and isinstance(inputs["positive"], list):
                    used_positive.add(str(inputs["positive"][0]))
                if "negative" in inputs and isinstance(inputs["negative"], list):
                    used_negative.add(str(inputs["negative"][0]))
                
                # Via guider node
                if "guider" in inputs and isinstance(inputs["guider"], list):
                    guider_id = str(inputs["guider"][0])
                    if guider_id in workflow:
                        guider_inputs = workflow[guider_id].get("inputs", {})
                        cond = guider_inputs.get("conditioning") or guider_inputs.get("positive")
                        if isinstance(cond, list):
                            used_positive.add(str(cond[0]))
                        if "negative" in guider_inputs and isinstance(guider_inputs["negative"], list):
                            used_negative.add(str(guider_inputs["negative"][0]))
        
        return (used_positive, used_negative)
    
    def _follow_conditioning_chain(self, node_id, workflow, visited=None):
        """Follow conditioning references to find the actual text encoding node."""
        if visited is None:
            visited = set()
        if node_id in visited or node_id not in workflow:
            return None
        visited.add(node_id)
        
        node_data = workflow[node_id]
        class_type = node_data.get("class_type", "")
        inputs = node_data.get("inputs", {})
        
        # If this is a text encoding node, return it - use regex
        if re.search(r'CLIPTextEncode|Text to Conditioning|TextEncode', class_type):
            return node_id
        
        # Follow conditioning input
        if "conditioning" in inputs and isinstance(inputs["conditioning"], list):
            next_node = str(inputs["conditioning"][0])
            return self._follow_conditioning_chain(next_node, workflow, visited)
        
        return None
    
    def _extract_text_from_node(self, node_id, workflow):
        """Extract text from a text encoding node."""
        if node_id not in workflow:
            return ""
        
        node_data = workflow[node_id]
        inputs = node_data.get("inputs", {})
        
        # Try common text field names
        for key in ["text", "user_prompt", "prompt", "positive", "system_prompt"]:
            if key in inputs:
                value = inputs[key]
                if isinstance(value, str):
                    return value
                # Resolve node references
                elif isinstance(value, list) and len(value) > 0:
                    ref_id = str(value[0])
                    if ref_id in workflow:
                        ref_inputs = workflow[ref_id].get("inputs", {})
                        for ref_key in ["value", "text", "string"]:
                            if ref_key in ref_inputs and isinstance(ref_inputs[ref_key], str):
                                return ref_inputs[ref_key]
        
        return ""
