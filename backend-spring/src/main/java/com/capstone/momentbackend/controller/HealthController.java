package com.capstone.momentbackend.controller;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
@RestController
@RequestMapping("/api/health")
public class HealthController {
 @GetMapping public Map<String,Object> health() {
  return Map.of("success", true, "message", "Backend server is running.");
 }
}
