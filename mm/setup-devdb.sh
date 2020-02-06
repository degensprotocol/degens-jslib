#!/bin/sh

set -e

mkdir -p dbs/
rm -f dbs/dev.db

sqlite3 dbs/dev.db < schema.sqlite3
