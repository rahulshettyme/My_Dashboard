import json

def add_attributes_to_payload(row, payload, env_config, target_key='data'):
    """
    Extracts additional attributes from row based on env_config and adds them to payload.
    
    Args:
        row (dict): The input excel row data.
        payload (dict): The api payload being constructed.
        env_config (dict): Configuration containing 'additionalAttributes' list.
        target_key (str, optional): The key inside payload to inject attributes into. 
                                    If None, injects into root of payload. 
                                    Defaults to 'data'.
    
    Returns:
        dict: The updated payload.
    """
    additional_attributes = env_config.get('additionalAttributes', [])
    
    if not additional_attributes:
        return payload

    # Determine validation target
    if target_key:
        if target_key not in payload:
            payload[target_key] = {}
        target_dict = payload[target_key]
    else:
        target_dict = payload

    print(f"DEBUG: Processing Shared Attributes. Configured: {additional_attributes}")

    for attr in additional_attributes:
        # 1. Try exact match
        val = row.get(attr)
        
        # 2. Fuzzy/Fallback match if not found
        if val is None:
            for k, v in row.items():
                if k.strip() == attr.strip(): # whitespace tolerant match
                    val = v
                    break
        
        # 3. Add to payload if found
        if val is not None:
            # FORCE STRING: API typically expects strings for attributes
            target_dict[attr] = str(val)
            # print(f"DEBUG: Added {attr}={target_dict[attr]}")
        else:
            print(f"DEBUG: Attribute '{attr}' NOT FOUND in row.")

    return payload
