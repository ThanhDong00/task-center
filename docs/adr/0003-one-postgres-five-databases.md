# One Postgres container with five logical databases for local dev

Per-service data ownership is enforced by separate TypeORM DataSources, not separate containers. Chosen to keep local RAM sane; moving to one container per service later needs only a compose change.
