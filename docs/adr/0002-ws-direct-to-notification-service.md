# WebSocket terminates direct at Notification Service, gateway proxies REST only

React SPA connects Socket.io straight to Notification Service; API Gateway routes REST and validates JWTs but does not proxy WS. Chosen to avoid proxy config fights; access token lives in memory, refresh in httpOnly cookie.
