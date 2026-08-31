@rem 绿角犀 Office Android 壳 · Gradle Wrapper (Windows)
@echo off
set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_HOME=%DIRNAME%
set APP_BASE_NAME=%~n0
set CLASSPATH=%APP_HOME%gradle\wrapper\gradle-wrapper.jar
set DEFAULT_JVM_OPTS="-Xmx64m" "-Xms64m"

if defined JAVA_HOME (
  set JAVACMD=%JAVA_HOME%\bin\java.exe
) else (
  set JAVACMD=java.exe
)

"%JAVACMD%" %DEFAULT_JVM_OPTS% %JAVA_OPTS% %GRADLE_OPTS% "-Dorg.gradle.appname=%APP_BASE_NAME%" -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
