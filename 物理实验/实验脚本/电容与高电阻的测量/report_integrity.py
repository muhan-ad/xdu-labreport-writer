"""Keep invalid references and proven contradictions hard; uncertain prose is advisory."""
from common.content_policy import inspect_text

def validate_text(text, data):
    return inspect_text(text, data)['text']
