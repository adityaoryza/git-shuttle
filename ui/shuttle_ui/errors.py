"""The one error the UI raises on purpose: a request that is refused, with a message for the user."""


class BadRequest(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status
