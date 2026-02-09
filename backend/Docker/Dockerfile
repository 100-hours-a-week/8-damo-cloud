FROM eclipse-temurin:21-jdk AS builder
WORKDIR /app

COPY gradlew .
COPY gradle/ gradle/
COPY build.gradle settings.gradle ./
RUN chmod +x gradlew
RUN ./gradlew --no-daemon dependencies

COPY src/ src/
RUN ./gradlew --no-daemon bootJar -x test

FROM eclipse-temurin:21-jdk AS runner
WORKDIR /app
ENV JAVA_OPTS=""

COPY --from=builder /app/build/libs/app.jar /app/app.jar

EXPOSE 8080
ENTRYPOINT ["sh","-c","java $JAVA_OPTS -jar /app/app.jar"]