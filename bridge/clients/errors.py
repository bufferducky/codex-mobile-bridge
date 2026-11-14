class BridgeUnavailable(ValueError):
    """The desktop adapter is disconnected or cannot confirm an operation."""

    def __init__(self, message, *, retryable=True, code='desktop_unavailable'):
        super().__init__(message)
        self.retryable = retryable
        self.code = code
