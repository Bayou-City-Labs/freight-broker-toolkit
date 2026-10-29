-- Runs once, on first initialization of the data volume.
-- Tests run against a separate database so a `drop and recreate` in the test
-- suite can never touch dev data.
CREATE DATABASE freight_test;
