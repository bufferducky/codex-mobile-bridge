"""Read console lock and aggregate idle time; never monitor individual input."""
import ctypes
import functools
import math


@functools.lru_cache(maxsize=1)
def _frameworks():
    cg = ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    cg.CGSessionCopyCurrentDictionary.restype = ctypes.c_void_p
    cg.CGEventSourceSecondsSinceLastEventType.argtypes = [ctypes.c_int, ctypes.c_uint32]
    cg.CGEventSourceSecondsSinceLastEventType.restype = ctypes.c_double
    cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    cf.CFStringCreateWithCString.restype = ctypes.c_void_p
    cf.CFDictionaryGetValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    cf.CFDictionaryGetValue.restype = ctypes.c_void_p
    cf.CFBooleanGetValue.argtypes = [ctypes.c_void_p]
    cf.CFBooleanGetValue.restype = ctypes.c_bool
    cf.CFRelease.argtypes = [ctypes.c_void_p]
    return cg, cf


def desktop_active():
    """True only for an unlocked console with input in the last 180 seconds.

    Unknown native state returns None so callers can keep notifications enabled.
    CGSession's lock flag is absent when unlocked; console/login flags are required.
    """
    try:
        cg, cf = _frameworks()
        session = cg.CGSessionCopyCurrentDictionary()
        if not session:
            return None
        try:
            def flag(name):
                key = cf.CFStringCreateWithCString(None, name.encode(), 0x08000100)
                if not key:
                    raise OSError('Cannot read console state')
                try:
                    value = cf.CFDictionaryGetValue(session, key)
                    return bool(cf.CFBooleanGetValue(value)) if value else None
                finally:
                    cf.CFRelease(key)
            locked = flag('CGSSessionScreenIsLocked')
            console = flag('kCGSSessionOnConsoleKey')
            logged_in = flag('kCGSessionLoginDoneKey')
            if locked or console is False or logged_in is False:
                return False
            if console is None or logged_in is None:
                return None
            idle = cg.CGEventSourceSecondsSinceLastEventType(0, 0xffffffff)
            return idle < 180 if math.isfinite(idle) and idle >= 0 else None
        finally:
            cf.CFRelease(session)
    except (OSError, AttributeError, ValueError):
        return None
