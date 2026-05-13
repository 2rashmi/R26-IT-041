"""
Simple backend startup file.

Run from backend folder:
    python app.py
"""

import uvicorn


if __name__ == "__main__":
    # Use import string so --reload works correctly.
    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=True)
