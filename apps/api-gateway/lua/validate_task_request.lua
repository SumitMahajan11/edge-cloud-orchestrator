-- validate_task_request.lua
-- Nginx Lua script for request validation at the API Gateway layer
-- Catches invalid requests early before they reach backend services

local json = require "cjson"

-- Only validate POST/PUT requests with body
local method = ngx.var.request_method

if method == "POST" or method == "PUT" then
    -- Read request body
    ngx.req.read_body()
    local body = ngx.var.request_body
    
    if not body or body == "" then
        ngx.status = 400
        ngx.header["Content-Type"] = "application/json"
        ngx.say('{"error":"Request body is required","status":400}')
        return ngx.exit(400)
    end
    
    -- Parse JSON
    local ok, data = pcall(json.decode, body)
    if not ok then
        ngx.status = 400
        ngx.header["Content-Type"] = "application/json"
        ngx.say('{"error":"Invalid JSON format","status":400}')
        return ngx.exit(400)
    end
    
    -- Validate required fields for task creation
    if method == "POST" then
        -- Check required fields: image and command
        if not data.image or type(data.image) ~= "string" then
            ngx.status = 400
            ngx.header["Content-Type"] = "application/json"
            ngx.say('{"error":"Missing or invalid required field: image","status":400}')
            return ngx.exit(400)
        end
        
        if not data.command or type(data.command) ~= "string" then
            ngx.status = 400
            ngx.header["Content-Type"] = "application/json"
            ngx.say('{"error":"Missing or invalid required field: command","status":400}')
            return ngx.exit(400)
        end
        
        -- Validate command is not empty
        if #data.command == 0 then
            ngx.status = 400
            ngx.header["Content-Type"] = "application/json"
            ngx.say('{"error":"Command field cannot be empty","status":400}')
            return ngx.exit(400)
        end
        
        -- Validate image is not empty
        if #data.image == 0 then
            ngx.status = 400
            ngx.header["Content-Type"] = "application/json"
            ngx.say('{"error":"Image field cannot be empty","status":400}')
            return ngx.exit(400)
        end
    end
    
    -- For PUT requests, validate that at least one field is being updated
    if method == "PUT" then
        if type(data) ~= "table" or next(data) == nil then
            ngx.status = 400
            ngx.header["Content-Type"] = "application/json"
            ngx.say('{"error":"Request body must contain at least one field to update","status":400}')
            return ngx.exit(400)
        end
    end
end

-- Request is valid, continue to backend
return
