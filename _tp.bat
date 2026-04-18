@echo off  
for %%%%P in (8787 8788) do ( for /f \"tokens=5\" %%%%A in ('netstat -ano ^| findstr \"LISTENING\" ^| findstr \":%%%%P \"') do echo PID %%%%A on %%%%P )  
