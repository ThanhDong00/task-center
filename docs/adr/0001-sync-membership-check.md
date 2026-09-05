# Task assignment validates membership via synchronous internal HTTP

Task Service calls Group Service (`GET /internal/groups/:id/members/:userId`) at assignment time instead of caching membership from events. Chosen because it is always correct with no invalidation to debug; accepted cost is fail-closed assignment when Group Service is down.
