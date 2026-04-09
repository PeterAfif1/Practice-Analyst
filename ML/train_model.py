
import os
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report
import pickle

from extract_features import load_dataset


def train():

    print("loading dataset...")

    X, y = load_dataset()

    print("\nsplitting into train and test sets...")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    print(f"training samples: {len(X_train)}")
    print(f"testing samples: {len(X_test)}")

    print("\nscaling features...")
    scaler = StandardScaler()

    X_train = scaler.fit_transform(X_train)

    X_test = scaler.transform(X_test)

    print("\ntraining Random Forest...")
    model = RandomForestClassifier(
        n_estimators=100,
        random_state=42
        )

    model.fit(X_train, y_train)

    print("\nevaluating model...")

    accuracy = model.score(X_test, y_test)
    print(f"accuracy: {accuracy * 100:.2f}%")

    y_pred = model.predict(X_test)
    print("\ndetailed report:")
    print(classification_report(y_test, y_pred))

    os.makedirs('models', exist_ok=True)

    with open('models/model.pkl', 'wb') as f:
        pickle.dump(model, f)

    with open('models/scaler.pkl', 'wb') as f:
        pickle.dump(scaler, f)

    print("\nmodel saved to models/model.pkl")
    print("\nscaler saved to models/scaler.pkl")
    print("\ntraining complete.")


if __name__ == "__main__":
    train()
